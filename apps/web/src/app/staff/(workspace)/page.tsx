"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStaff } from "@/components/suite/staff-workspace";
import { staffHome } from "@/components/suite/staff-navigation";
export default function Page() {
  const {
    user,
    language: { t },
  } = useStaff();
  const router = useRouter();
  useEffect(() => {
    router.replace(staffHome(user.role));
  }, [router, user.role]);
  return <p>{t("loading")}</p>;
}
