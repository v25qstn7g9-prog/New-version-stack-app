import { MyMCP } from "./mcp"
export { MyMCP }

// 在原本的 fetch 裡面加這段
if (url.pathname.startsWith("/mcp") || url.pathname.startsWith("/sse")) {
  return MyMCP.serve(request, env, ctx)
}
