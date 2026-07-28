import { describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("API 客户端", () => {
  it("解析结构化错误体", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: "PROJECT_BUSY",
        message: "项目正在执行其他操作",
        context: { operationId: "op-1" },
      },
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(api.start("9341d0a8-9094-4f62-8b44-943c144aaef5")).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "PROJECT_BUSY",
      message: "项目正在执行其他操作",
    });
  });

  it("将网络异常统一为 ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(api.listProjects()).rejects.toEqual(
      expect.objectContaining({
        name: "ApiError",
        status: null,
        code: "NETWORK_ERROR",
        message: "网络连接失败：Failed to fetch",
      }),
    );
  });

  it("拒绝不符合共享契约的成功响应", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ projects: [{ malformed: true }] }),
      { status: 200 },
    )));

    await expect(api.listProjects()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "服务端返回的数据格式不正确",
    });
  });
});

