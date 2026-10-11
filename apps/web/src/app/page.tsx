"use client";
import Link from "next/link";
import { Shell, useLanguage } from "@/components/suite/common";
export default function Home() {
  const l = useLanguage();
  return (
    <Shell language={l}>
      <section>
        <h1>{l.t("home")}</h1>
        <p>{l.t("privacy")}</p>
        <p>
          <Link href="/report">{l.t("report")}</Link>
        </p>
        <p>
          <Link href="/case">{l.t("portal")}</Link>
        </p>
      </section>
    </Shell>
  );
}
