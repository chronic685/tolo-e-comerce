// Normalizes an Ethiopian phone number to +251XXXXXXXXX (E.164, 9-digit
// subscriber number). Accepts the formats a backend or a person might hand
// back: with or without a leading "+", with "251" already present, with a
// local leading "0", and with spaces/dashes/parens mixed in. Returns null
// for anything that doesn't resolve to a 9-digit mobile number starting
// with 7 or 9 -- callers must treat null as "reject", never guess a value.
export function normalizeEthiopianPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");

  let rest: string;
  if (digits.startsWith("+251")) {
    rest = digits.slice(4);
  } else if (digits.startsWith("251")) {
    rest = digits.slice(3);
  } else if (digits.startsWith("0")) {
    rest = digits.slice(1);
  } else {
    rest = digits.replace(/^\+/, "");
  }

  if (!/^[79]\d{8}$/.test(rest)) return null;
  return `+251${rest}`;
}
