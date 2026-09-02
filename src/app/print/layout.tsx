import { requireAccess } from "@/server/guard";

export const dynamic = "force-dynamic";

/** Printable order documents are subject to the same order-access policy as the CRM. */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  await requireAccess("/orders");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "white",
        color: "#1a1a1a",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {children}
    </div>
  );
}
