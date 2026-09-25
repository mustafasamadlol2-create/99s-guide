import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createAdminStudyPointsJsonParser,
  createAdminStudyPointsRouter,
} from "../server/routes/adminStudyPoints.js";

type TestServer = {
  server: Server;
  baseUrl: string;
  calls: string[];
  close(): Promise<void>;
};

async function createTestServer(): Promise<TestServer> {
  const calls: string[] = [];
  let projection: Record<string, unknown> | null = null;
  const tx = {
    user: {
      async findUnique() {
        return { id: "user-1" };
      },
    },
    studyPointsLedgerEntry: {
      async findMany() {
        return [];
      },
      async groupBy() {
        return [];
      },
    },
    studyPointsBalanceProjection: {
      async findUnique() {
        return projection;
      },
      async upsert(args: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) {
        calls.push("projection.upsert");
        projection = {
          ...args.create,
          ...args.update,
          createdAt: new Date("2026-09-25T10:00:00.000Z"),
          updatedAt: new Date("2026-09-25T10:00:00.000Z"),
        };
        return projection;
      },
    },
    pointsLog: {
      async aggregate() {
        return { _sum: { points: null } };
      },
    },
    async $queryRaw() {
      return [{ count: "0" }];
    },
  };
  const database = {
    async $transaction(run: (transaction: typeof tx) => Promise<unknown>) {
      return run(tx);
    },
  } as unknown as PrismaClient;
  const requireAdmin: RequestHandler = (req, res, next) => {
    const role = req.headers["x-test-role"];
    if (!role) return res.status(401).json({ error: "Authentication required." });
    if (role !== "admin" && role !== "owner") {
      return res.status(403).json({ error: "Administrative role required." });
    }
    next();
  };
  const app = express();
  app.use("/api/admin/study-points", createAdminStudyPointsJsonParser());
  app.use(express.json({ limit: "20mb" }));
  app.use(
    "/api/admin/study-points",
    createAdminStudyPointsRouter({ requireAdmin, database }),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    calls,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      );
    },
  };
}

test("reconciliation APIs are owner/admin only and repair accepts no accounting values", async () => {
  const server = await createTestServer();
  try {
    const path = `${server.baseUrl}/api/admin/study-points/users/user-1/reconciliation`;
    assert.equal((await fetch(path)).status, 401);
    assert.equal((await fetch(path, {
      headers: { "x-test-role": "student" },
    })).status, 403);
    assert.equal((await fetch(path, {
      headers: { "x-test-role": "user" },
    })).status, 403);
    assert.equal(server.calls.length, 0);

    const dryRun = await fetch(path, { headers: { "x-test-role": "owner" } });
    assert.equal(dryRun.status, 200);
    assert.equal(dryRun.headers.get("cache-control"), "no-store, private");
    const result = await dryRun.json() as { status: string; repaired: boolean };
    assert.equal(result.status, "PROJECTION_MISSING");
    assert.equal(result.repaired, false);

    const arbitraryValues = await fetch(`${path}/repair-projection`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-role": "admin",
      },
      body: JSON.stringify({ targetPoints: 900 }),
    });
    assert.equal(arbitraryValues.status, 400);
    assert.equal(server.calls.length, 0);

    const repair = await fetch(`${path}/repair-projection`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-test-role": "admin",
      },
      body: "{}",
    });
    assert.equal(repair.status, 200);
    const repairResult = await repair.json() as {
      repaired: boolean;
      status: string;
    };
    assert.equal(repairResult.repaired, true);
    assert.equal(repairResult.status, "IN_SYNC");
    assert.deepEqual(server.calls, ["projection.upsert"]);
  } finally {
    await server.close();
  }
});

test("repair parser rejects oversized reconciliation payloads", async () => {
  const server = await createTestServer();
  try {
    const response = await fetch(
      `${server.baseUrl}/api/admin/study-points/users/user-1/reconciliation/repair-projection`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-test-role": "owner",
        },
        body: JSON.stringify({ irrelevant: "x".repeat(10_000) }),
      },
    );
    assert.equal(response.status, 413);
  } finally {
    await server.close();
  }
});