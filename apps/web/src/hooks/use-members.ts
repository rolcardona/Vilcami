import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { membersApi, type MemberResponse } from "@/api/members";
import type { Permission } from "@/lib/constants";

export function useMembers() {
  return useQuery({
    queryKey: ["members"],
    queryFn: () => membersApi.listMembers(),
  });
}

export function useUpdatePermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memberId, permissions }: { memberId: string; permissions: Permission[] }) =>
      membersApi.updatePermissions(memberId, permissions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });
}