export class WrongRegionError extends Error {
  constructor(message: string) {
    super();
    this.name = "WrongRegionError";
    this.message = message;
  }
}

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super();
    this.name = "AccessDeniedError";
    this.message = message;
  }
}
