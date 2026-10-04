// API amounts remain decimal strings. Presentation must never round through floats.
export function moneyCents(value: string | null | undefined): bigint | null {
  if (value == null) return null;
  const normalized = value.replace(/,/g, "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const cents =
    BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -cents : cents;
}

export function decimalMoney(cents: bigint): string {
  const positive = cents < 0n ? -cents : cents;
  return `${cents < 0n ? "-" : ""}${positive / 100n}.${String(positive % 100n).padStart(2, "0")}`;
}

export function formatMoney(value: string | null | undefined): string {
  const cents = moneyCents(value);
  if (cents === null) return "—";
  const [whole, fraction] = decimalMoney(cents).split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction;
}

export function sumMoney(values: string[]): string | null {
  let total = 0n;
  for (const value of values) {
    const cents = moneyCents(value);
    if (cents === null) return null;
    total += cents;
  }
  return decimalMoney(total);
}

export function displayAmount(
  value: string | null | undefined,
  hidden = false,
  signed = false,
): string {
  if (hidden) return "¥••••";
  const cents = moneyCents(value);
  if (cents === null) return "—";
  return `${cents < 0n ? "−" : signed ? "+" : ""}¥${formatMoney(decimalMoney(cents < 0n ? -cents : cents))}`;
}
