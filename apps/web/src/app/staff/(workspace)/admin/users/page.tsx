import { Suspense } from "react";
import { UserList } from "@/components/suite/users";
export default function Page() {
  return (
    <Suspense>
      <UserList />
    </Suspense>
  );
}
