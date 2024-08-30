export class IsThawingError extends Error {
  constructor(message: string) {
    super();
    this.name = "IsThawingError";
    this.message = message;
  }
}
