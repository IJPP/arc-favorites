import { t } from "./i18n";

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
  return error instanceof Error ? error.message : t("errUnknown");
}
