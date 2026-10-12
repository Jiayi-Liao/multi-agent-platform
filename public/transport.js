import { StaticDemo } from "./static-demo.js";
export async function createTransport(project) {
  if (document.documentElement.dataset.mode === "demo") {
    const response = await fetch(new URL("./samples.json", import.meta.url));
    if (!response.ok)
      throw new Error("Unable to load the public demo samples.");
    const demo = new StaticDemo(await response.json(), project);
    return {
      staticDemo: true,
      request: (path, data) => demo.request(path, data),
      subscribe: (id, after) => demo.subscribe(id, after),
      close: () => demo.close(),
    };
  }
  return {
    staticDemo: false,
    async request(path, data) {
      const response = await fetch(
        path,
        data === undefined
          ? {}
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(data),
            },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Request failed.");
      return result;
    },
    subscribe: (id, after) =>
      new EventSource(`/api/runs/${id}/stream?after=${after}`),
    close() {},
  };
}
