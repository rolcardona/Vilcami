import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { billingApi } from "@/api/billing";

export function usePlans() {
  return useQuery({ queryKey: ["billing", "plans"], queryFn: () => billingApi.getPlans() });
}

export function useSubscription() {
  return useQuery({ queryKey: ["billing", "subscription"], queryFn: () => billingApi.getSubscription() });
}

export function usePayments(limit = 20) {
  return useQuery({
    queryKey: ["billing", "payments", limit],
    queryFn: () => billingApi.getPayments(limit),
  });
}

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ planId, deviceCount, returnUrl }: { planId: string; deviceCount: number; returnUrl: string }) =>
      billingApi.checkout(planId, deviceCount, returnUrl),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }),
  });
}