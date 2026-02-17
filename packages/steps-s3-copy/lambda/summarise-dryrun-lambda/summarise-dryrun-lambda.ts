export async function handler(event: any) {
  return {
    message: "Dry run: no files copied.",
    input: event,
    time: new Date().toISOString(),
  };
}
