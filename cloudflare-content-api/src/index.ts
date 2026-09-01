export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/health") {
      return new Response("Not Found", {
        status: 404,
      });
    }

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
      console.error(error);

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
  },
};