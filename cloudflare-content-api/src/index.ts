export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    // ---------------------------------------------------------
    // HEALTH CHECK
    // ---------------------------------------------------------
    if (url.pathname === "/health") {
      try {
        const dbResult = await env.DB
          .prepare("SELECT 1 AS ok")
          .first();

        const r2Result = await env.FILES.list({
          limit: 1,
        });

        return Response.json({
          ok: true,

          worker: {
            status: "ready",
          },

          d1: {
            connected: dbResult?.ok === 1,
          },

          r2: {
            connected: true,
            objectCheckCompleted: true,
            returnedObjects: r2Result.objects.length,
          },

          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[Health]", error);

        return Response.json(
          {
            ok: false,
            error: "Cloudflare resource binding check failed",
          },
          {
            status: 500,
          },
        );
      }
    }

    // ---------------------------------------------------------
    // PUBLIC AVATAR DELIVERY
    //
    // URL:
    // /avatars/<userId>/<filename>
    //
    // R2:
    // avatars/<userId>/<filename>
    // ---------------------------------------------------------
    if (url.pathname.startsWith("/avatars/")) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: {
            Allow: "GET, HEAD",
          },
        });
      }

      const parts = url.pathname
        .split("/")
        .filter(Boolean);

      // Expected:
      // ["avatars", "<userId>", "<filename>"]
      if (parts.length !== 3) {
        return new Response("Not Found", {
          status: 404,
        });
      }

      const userId = parts[1];
      const fileName = parts[2];

      // Strict validation prevents arbitrary R2 object access.
      if (
        !/^[A-Za-z0-9_-]+$/.test(userId) ||
        !/^[A-Za-z0-9_-]+\.(webp|png|jpg|jpeg)$/i.test(fileName)
      ) {
        return new Response("Invalid avatar path", {
          status: 400,
        });
      }

      const objectKey = `avatars/${userId}/${fileName}`;

      try {
        const object = await env.FILES.get(objectKey);

        if (!object) {
          return new Response("Avatar Not Found", {
            status: 404,
            headers: {
              "Cache-Control": "no-store",
            },
          });
        }

        const headers = new Headers();

        object.writeHttpMetadata(headers);

        headers.set(
          "Content-Type",
          headers.get("Content-Type") || "image/webp",
        );

        if (object.httpEtag) {
          headers.set("ETag", object.httpEtag);
        }

        // Our future avatar filenames are versioned.
        // Therefore each URL can safely be cached for a long time.
        headers.set(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );

        headers.set(
          "X-Content-Type-Options",
          "nosniff",
        );

        headers.set(
          "Access-Control-Allow-Origin",
          "*",
        );

        if (request.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers,
          });
        }

        return new Response(object.body, {
          status: 200,
          headers,
        });
      } catch (error) {
        console.error("[AvatarDelivery]", error);

        return new Response("Avatar delivery failed", {
          status: 500,
        });
      }
    }

    return new Response("Not Found", {
      status: 404,
    });
  },
};