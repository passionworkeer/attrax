import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin/auth";
import LoginForm from "../LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "管理员登录 · 规航AI", robots: { index: false, follow: false } };
export default async function AdminLoginPage() {
  if (await isAdmin()) redirect("/admin");
  return <LoginForm />;
}
