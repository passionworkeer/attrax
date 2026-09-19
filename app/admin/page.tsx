import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin/auth";
import Dashboard from "./Dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "运营看板 · 规航AI", robots: { index: false, follow: false } };
export default async function AdminPage() {
  if (!await isAdmin()) redirect("/admin/login");
  return <Dashboard />;
}
