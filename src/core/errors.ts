export class FavoritesError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FavoritesError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "发生了未知错误";
}
