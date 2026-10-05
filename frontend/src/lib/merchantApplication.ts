// Client-side half of the merchant application (migrations 0072/0073).
// Every rule here is also enforced server-side -- the bucket's own
// type/size limits and submit_merchant_application()'s checks -- this only
// lets the form say what's wrong before a round trip.

export const LICENSE_BUCKET = "merchant-application-licenses";

/** The application asks for a TIN (migration 0094) instead of a license photo. The photo upload is kept
 * and still works end to end (storage bucket, submit_merchant_application's optional photo argument, the
 * admin "View photo" button for old applications); this switch just hides it. Flip it to true to bring the
 * upload back alongside the TIN. */
export const LICENSE_UPLOAD_ENABLED = false;

/** A Taxpayer Identification Number: exactly 10 digits. Mirrors the database check. */
const TIN_PATTERN = /^[0-9]{10}$/;
export function isValidTin(value: string): boolean {
  return TIN_PATTERN.test(value);
}

// Must match migration 0073's bucket config.
export const LICENSE_MAX_BYTES = 5 * 1024 * 1024;
export const LICENSE_MIME_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type LicenseFileError = "merchantApply.error.licenseType" | "merchantApply.error.licenseSize";

export function validateLicenseFile(file: Pick<File, "type" | "size">): LicenseFileError | null {
  if (!(file.type in LICENSE_MIME_TYPES)) return "merchantApply.error.licenseType";
  if (file.size > LICENSE_MAX_BYTES) return "merchantApply.error.licenseSize";
  return null;
}

/** Storage path inside the caller's own folder -- the only place the
 * storage insert policy lets them upload, and the only place
 * submit_merchant_application() accepts a license from. */
export function licensePath(userId: string, file: Pick<File, "type">, id: string): string {
  return `${userId}/${id}.${LICENSE_MIME_TYPES[file.type] ?? "img"}`;
}

const SUBMIT_ERRORS = [
  "phone_not_verified",
  "account_inactive",
  "invalid_category",
  "invalid_license_photo",
  "invalid_tin",
  "tin_already_registered",
  "already_merchant",
  "application_pending",
  "invalid_details",
] as const;

/** Maps submit_merchant_application()'s stable error messages to a
 * translation key; anything unexpected gets the generic one. */
export function submitErrorKey(message: string | undefined): string {
  const code = SUBMIT_ERRORS.find((c) => message === c);
  return code ? `merchantApply.error.${code}` : "merchantApply.error.generic";
}
