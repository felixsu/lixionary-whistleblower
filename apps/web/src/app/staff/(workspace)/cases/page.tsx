import { Suspense } from "react";
import { CaseList } from "@/components/suite/case-workspace";
export default function Page() {
  return (
    <Suspense>
      <CaseList />
    </Suspense>
  );
}
