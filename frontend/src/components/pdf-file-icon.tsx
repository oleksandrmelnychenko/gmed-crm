import { cn } from "@/lib/utils";

export function PdfFileIcon({ className }: { className?: string }) {
  return <svg
    viewBox="0 0 24 24"
    className={cn("size-4 shrink-0 text-red-600 dark:text-red-400", className)}
    fill="none"
    aria-hidden="true"
    focusable="false"
    data-slot="pdf-file-icon"
  >
    <path d="M6 13V4a2 2 0 0 1 2-2h7l5 5v13a2 2 0 0 1-2 2H8" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M15 2v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <rect x="1" y="12" width="21" height="10" rx="2" fill="currentColor" />
    <text x="11.5" y="19.25" fill="white" fontFamily="Arial, sans-serif" fontSize="7.5" fontWeight="700" textAnchor="middle">PDF</text>
  </svg>;
}
