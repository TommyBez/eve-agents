import { redirect } from "next/navigation";

// The docs tree is the whole site; no separate landing page to maintain.
export default function HomePage() {
  redirect("/docs");
}
