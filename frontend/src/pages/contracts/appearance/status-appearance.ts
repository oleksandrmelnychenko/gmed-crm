export function contractStatusClassName(status: string) {
  switch (status) {
    case "signed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "sent":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "expired":
    case "terminated":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

export function quoteStatusClassName(status: string) {
  switch (status) {
    case "accepted":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "sent":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "rejected":
    case "expired":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}
