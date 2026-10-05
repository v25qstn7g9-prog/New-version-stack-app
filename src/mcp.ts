import { McpAgent } from "agents/mcp"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

export class MyMCP extends McpAgent {
  server = new McpServer({ name: "new-version-stock", version: "1.0.0" })
  async init() {
    // 這裡就是你說的 stock 工具，你改成你自己的邏輯
    this.server.tool(
      "get_stock",
      { product_id: z.string() },
      async ({ product_id }) => {
        return { content: [{ type: "text", text: `庫存查詢: ${product_id} 還有 100 件` }] }
      }
    )
  }
}
