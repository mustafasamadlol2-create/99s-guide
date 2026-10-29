import groupFocusWorker, {
  GroupFocusRoom,
  type GroupFocusWorkerEnvironment,
} from "./cloudflare-group-focus-worker/src/index.js";

export { GroupFocusRoom };

type MainWorkerEnvironment = GroupFocusWorkerEnvironment & {
  ASSETS: Fetcher;
};

export default {
  async fetch(request: Request, environment: MainWorkerEnvironment): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/group-focus/")) {
      return groupFocusWorker.fetch(request, environment);
    }
    return environment.ASSETS.fetch(request);
  },
};
