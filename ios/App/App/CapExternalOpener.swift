import UIKit
import Capacitor

@objc(CapExternalOpener)
public final class CapExternalOpener:
    CAPPlugin,
    CAPBridgedPlugin,
    UIDocumentInteractionControllerDelegate,
    UIImagePickerControllerDelegate,
    UINavigationControllerDelegate
{
    public let identifier = "CapExternalOpener"
    public let jsName = "CapExternalOpener"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(
            name: "openPdf",
            returnType: CAPPluginReturnPromise
        ),
        CAPPluginMethod(
            name: "pickProfilePhoto",
            returnType: CAPPluginReturnPromise
        ),
    ]

    // Keep the preview controller alive strongly for the whole presentation.
    private var documentController: UIDocumentInteractionController?

    // The active avatar picker call. Only one picker may exist at a time.
    private var profilePhotoCall: CAPPluginCall?
    private weak var profilePhotoPicker: UIImagePickerController?

    // Represents the currently-authoritative PDF operation.
    // Old async callbacks are ignored once a newer operation begins.
    private var currentOperationID: UUID?

    @objc public func pickProfilePhoto(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else {
                call.reject("profile_photo_picker_unavailable")
                return
            }

            guard self.profilePhotoCall == nil else {
                call.reject("profile_photo_picker_busy")
                return
            }

            guard UIImagePickerController.isSourceTypeAvailable(.photoLibrary) else {
                call.reject("photo_library_unavailable")
                return
            }

            guard let presenter = self.bridge?.viewController else {
                call.reject("profile_photo_presenter_unavailable")
                return
            }

            let picker = UIImagePickerController()
            picker.sourceType = .photoLibrary
            picker.mediaTypes = ["public.image"]
            picker.allowsEditing = false
            picker.delegate = self

            // On iPad, use a native popover anchored to the app itself. Unlike
            // WKWebView's file-input flow, selecting a photo calls the delegate
            // directly; there is no WebKit preview/confirmation page in between.
            if UIDevice.current.userInterfaceIdiom == .pad {
                picker.modalPresentationStyle = .popover
                if let popover = picker.popoverPresentationController {
                    popover.sourceView = presenter.view
                    popover.sourceRect = CGRect(
                        x: presenter.view.bounds.midX,
                        y: presenter.view.bounds.midY,
                        width: 1,
                        height: 1
                    )
                    popover.permittedArrowDirections = []
                }
            } else {
                picker.modalPresentationStyle = .fullScreen
            }

            self.profilePhotoCall = call
            self.profilePhotoPicker = picker
            presenter.present(picker, animated: true)
        }
    }

    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        let call = profilePhotoCall
        profilePhotoCall = nil
        profilePhotoPicker = nil

        picker.dismiss(animated: true) {
            call?.resolve(["cancelled": true])
        }
    }

    public func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        let call = profilePhotoCall
        profilePhotoCall = nil
        profilePhotoPicker = nil

        guard let image = info[.originalImage] as? UIImage else {
            picker.dismiss(animated: true) {
                call?.reject("profile_photo_missing_image")
            }
            return
        }

        // Dismiss the Apple picker immediately. Image processing happens after
        // dismissal so the user lands directly back in the app-owned crop editor.
        picker.dismiss(animated: true) {
            DispatchQueue.global(qos: .userInitiated).async {
                guard let dataUrl = self.profilePhotoDataURL(from: image) else {
                    DispatchQueue.main.async {
                        call?.reject("profile_photo_processing_failed")
                    }
                    return
                }

                DispatchQueue.main.async {
                    call?.resolve([
                        "cancelled": false,
                        "dataUrl": dataUrl,
                    ])
                }
            }
        }
    }

    private func profilePhotoDataURL(from image: UIImage) -> String? {
        // Avatar cropping does not need the full multi-megapixel source. Keeping
        // the longest side at <= 2048 px dramatically reduces bridge payload and
        // memory use while preserving far more detail than the final 400x400 crop.
        let maxDimension: CGFloat = 2048
        let sourceSize = image.size
        guard sourceSize.width > 0, sourceSize.height > 0 else { return nil }

        let scale = min(
            1,
            maxDimension / max(sourceSize.width, sourceSize.height)
        )
        let targetSize = CGSize(
            width: max(1, floor(sourceSize.width * scale)),
            height: max(1, floor(sourceSize.height * scale))
        )

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true

        let renderer = UIGraphicsImageRenderer(size: targetSize, format: format)
        let normalizedImage = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }

        guard let jpeg = normalizedImage.jpegData(compressionQuality: 0.90) else {
            return nil
        }

        return "data:image/jpeg;base64," + jpeg.base64EncodedString()
    }

    @objc public func openPdf(_ call: CAPPluginCall) {
        guard
            let raw = call.getString("url"),
            let url = URL(string: raw),
            let scheme = url.scheme?.lowercased(),
            scheme == "https" || scheme == "http"
        else {
            call.reject("invalid_pdf_url")
            return
        }

        let operationID = UUID()

        DispatchQueue.main.async { [weak self] in
            self?.currentOperationID = operationID
        }

        NSLog(
            "[PDF-FINAL] openPdf START operation=%@ host=%@ path=%@",
            operationID.uuidString,
            url.host ?? "",
            url.path
        )

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData

        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false

        let session = URLSession(configuration: configuration)

        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: 30
        )

        request.httpMethod = "GET"

        request.setValue(
            "application/pdf,application/octet-stream;q=0.9,*/*;q=0.1",
            forHTTPHeaderField: "Accept"
        )

        request.setValue(
            "no-cache",
            forHTTPHeaderField: "Cache-Control"
        )

        request.setValue(
            "no-cache",
            forHTTPHeaderField: "Pragma"
        )

        session.dataTask(with: request) { [weak self] data, response, error in
            defer {
                session.finishTasksAndInvalidate()
            }

            guard let self = self else {
                call.reject("pdf_plugin_unavailable")
                return
            }

            /*
             * Ignore callbacks belonging to a superseded operation.
             *
             * This prevents an older asynchronous download from producing
             * a late rejection after another PDF operation has already
             * succeeded.
             */
            guard self.isCurrentOperation(operationID) else {
                NSLog(
                    "[PDF-FINAL] ignoring stale operation callback=%@",
                    operationID.uuidString
                )
                return
            }

            if let error = error {
                NSLog(
                    "[PDF-FINAL] network FAILED operation=%@ code=%d message=%@",
                    operationID.uuidString,
                    (error as NSError).code,
                    error.localizedDescription
                )

                self.reject(
                    call,
                    operationID: operationID,
                    code: "pdf_network_failed",
                    message: error.localizedDescription,
                    error: error
                )

                return
            }

            guard let http = response as? HTTPURLResponse else {
                self.reject(
                    call,
                    operationID: operationID,
                    code: "pdf_invalid_http_response"
                )
                return
            }

            let contentType =
                (
                    http.value(
                        forHTTPHeaderField: "Content-Type"
                    ) ?? ""
                )
                .lowercased()

            NSLog(
                "[PDF-FINAL] HTTP operation=%@ status=%d Content-Type=%@",
                operationID.uuidString,
                http.statusCode,
                contentType
            )

            guard (200...299).contains(http.statusCode) else {
                let snippet: String

                if
                    let data = data,
                    let text = String(
                        data: data.prefix(500),
                        encoding: .utf8
                    )
                {
                    snippet = text.replacingOccurrences(
                        of: "\n",
                        with: " "
                    )
                } else {
                    snippet = "<non-text response>"
                }

                NSLog(
                    "[PDF-FINAL] HTTP failure operation=%@ snippet=%@",
                    operationID.uuidString,
                    snippet
                )

                self.reject(
                    call,
                    operationID: operationID,
                    code: "pdf_http_\(http.statusCode)"
                )

                return
            }

            guard
                let data = data,
                data.count >= 5
            else {
                NSLog(
                    "[PDF-FINAL] response empty operation=%@",
                    operationID.uuidString
                )

                self.reject(
                    call,
                    operationID: operationID,
                    code: "pdf_empty_response"
                )

                return
            }

            let magic =
                String(
                    data: data.prefix(5),
                    encoding: .ascii
                ) ?? ""

            NSLog(
                "[PDF-FINAL] bytes operation=%@ magic=%@ size=%d",
                operationID.uuidString,
                magic,
                data.count
            )

            guard magic == "%PDF-" else {
                let snippet =
                    String(
                        data: data.prefix(500),
                        encoding: .utf8
                    )?
                    .replacingOccurrences(
                        of: "\n",
                        with: " "
                    ) ?? "<binary response>"

                NSLog(
                    "[PDF-FINAL] NOT PDF operation=%@ snippet=%@",
                    operationID.uuidString,
                    snippet
                )

                self.reject(
                    call,
                    operationID: operationID,
                    code: "response_is_not_pdf"
                )

                return
            }

            do {
                let tempDirectory =
                    FileManager.default
                    .temporaryDirectory
                    .appendingPathComponent(
                        "99s-guide-pdf",
                        isDirectory: true
                    )

                try FileManager.default.createDirectory(
                    at: tempDirectory,
                    withIntermediateDirectories: true,
                    attributes: nil
                )

                let fileURL =
                    tempDirectory
                    .appendingPathComponent(
                        UUID().uuidString
                    )
                    .appendingPathExtension("pdf")

                try data.write(
                    to: fileURL,
                    options: [.atomic]
                )

                NSLog(
                    "[PDF-FINAL] PDF ready operation=%@ path=%@",
                    operationID.uuidString,
                    fileURL.path
                )

                DispatchQueue.main.async { [weak self] in
                    guard let self = self else {
                        call.reject(
                            "pdf_plugin_unavailable"
                        )
                        return
                    }

                    guard self.isCurrentOperation(operationID) else {
                        NSLog(
                            "[PDF-FINAL] stale presentation ignored operation=%@",
                            operationID.uuidString
                        )
                        return
                    }

                    guard
                        let presenter =
                            self.bridge?.viewController
                    else {
                        self.reject(
                            call,
                            operationID: operationID,
                            code: "pdf_presenter_unavailable"
                        )
                        return
                    }

                    self.presentPdf(
                        fileURL,
                        presenter: presenter,
                        call: call,
                        operationID: operationID
                    )
                }

            } catch {
                NSLog(
                    "[PDF-FINAL] temp write FAILED operation=%@ error=%@",
                    operationID.uuidString,
                    error.localizedDescription
                )

                self.reject(
                    call,
                    operationID: operationID,
                    code: "pdf_temp_write_failed",
                    message: error.localizedDescription,
                    error: error
                )
            }

        }.resume()
    }

    // MARK: - Presentation

    private func presentPdf(
        _ fileURL: URL,
        presenter: UIViewController,
        call: CAPPluginCall,
        operationID: UUID
    ) {
        guard isCurrentOperation(operationID) else {
            return
        }

        /*
         * Remove only our previous PDF controller.
         *
         * Do not treat dismissal of a previous preview as a failure.
         */
        if let oldController = documentController {
            oldController.dismissPreview(animated: false)
            documentController = nil
        }

        let presentBlock = { [weak self] in
            guard let self = self else {
                call.reject("pdf_plugin_unavailable")
                return
            }

            guard self.isCurrentOperation(operationID) else {
                return
            }

            let controller =
                UIDocumentInteractionController(
                    url: fileURL
                )

            controller.delegate = self
            controller.name = "PDF"

            /*
             * Strong reference is essential.
             * Without this, UIKit may lose the controller while its
             * preview is on screen.
             */
            self.documentController = controller

            NSLog(
                "[PDF-FINAL] presentation START operation=%@",
                operationID.uuidString
            )

            /*
             * IMPORTANT:
             *
             * At this point all operations that can legitimately fail have
             * succeeded:
             *
             * - URL validated
             * - HTTP request succeeded
             * - response is a real PDF
             * - file was written successfully
             * - presenter exists
             * - UIDocumentInteractionController is retained
             *
             * Dispatching the native preview is therefore the terminal
             * success point for the JS promise.
             *
             * UIKit preview lifecycle/dismissal must NEVER turn this
             * successful operation back into a rejection.
             */
            let presented =
                controller.presentPreview(
                    animated: true
                )

            NSLog(
                "[PDF-FINAL] presentPreview operation=%@ returned=%@",
                operationID.uuidString,
                presented ? "true" : "false"
            )

            /*
             * Do not interpret presentPreview(false) as a JS failure here.
             *
             * On the affected iOS flow the preview can already be visibly
             * transitioning/presented while UIKit reports a false result.
             *
             * The PDF is valid and the presentation request was dispatched.
             * This transaction is now SUCCESS and must be terminal.
             */
            self.resolveSuccess(
                call,
                operationID: operationID
            )
        }

        /*
         * If another controller is currently presented, dismiss it first.
         * The PDF operation remains pending until the new preview request
         * is actually dispatched.
         */
        if presenter.presentedViewController != nil {
            presenter.dismiss(
                animated: false
            ) {
                presentBlock()
            }
        } else {
            presentBlock()
        }
    }

    // MARK: - Promise completion

    private func resolveSuccess(
        _ call: CAPPluginCall,
        operationID: UUID
    ) {
        guard isCurrentOperation(operationID) else {
            return
        }

        /*
         * Clear the operation BEFORE resolving.
         *
         * Any asynchronous stale callback that arrives afterward can no
         * longer reject this successful transaction.
         */
        currentOperationID = nil

        NSLog(
            "[PDF-FINAL] JS SUCCESS terminal operation=%@",
            operationID.uuidString
        )

        call.resolve([
            "ok": true
        ])
    }

    private func reject(
        _ call: CAPPluginCall,
        operationID: UUID,
        code: String,
        message: String? = nil,
        error: Error? = nil
    ) {
        guard isCurrentOperation(operationID) else {
            NSLog(
                "[PDF-FINAL] stale rejection SUPPRESSED operation=%@ code=%@",
                operationID.uuidString,
                code
            )
            return
        }

        currentOperationID = nil

        NSLog(
            "[PDF-FINAL] JS FAILURE terminal operation=%@ code=%@",
            operationID.uuidString,
            code
        )

        if let error = error {
            call.reject(
                code,
                message,
                error
            )
        } else {
            call.reject(code)
        }
    }

    private func isCurrentOperation(
        _ operationID: UUID
    ) -> Bool {
        return currentOperationID == operationID
    }

    // MARK: - UIDocumentInteractionControllerDelegate

    public func documentInteractionControllerViewControllerForPreview(
        _ controller: UIDocumentInteractionController
    ) -> UIViewController {
        return bridge?.viewController ?? UIViewController()
    }

    public func documentInteractionControllerDidEndPreview(
        _ controller: UIDocumentInteractionController
    ) {
        /*
         * Closing the PDF preview is normal user behavior.
         *
         * NEVER reject the already-successful Capacitor call here.
         */
        if documentController === controller {
            documentController = nil
        }

        NSLog(
            "[PDF-FINAL] preview dismissed normally"
        )
    }
}