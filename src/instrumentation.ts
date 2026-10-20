export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { boot } = await import("./lib/boot");
    boot();
  }
}
