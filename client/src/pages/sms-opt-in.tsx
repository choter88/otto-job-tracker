import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MessageSquare, CheckCircle } from "lucide-react";

const optInSchema = z.object({
  phone: z.string().min(10, "Please enter a valid phone number"),
  officeId: z.string().min(1, "Office ID is required"),
  consent: z.boolean().refine(val => val === true, "You must consent to receive SMS notifications"),
});

type OptInFormData = z.infer<typeof optInSchema>;

export default function SMSOptIn() {
  const { toast } = useToast();
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<OptInFormData>({
    resolver: zodResolver(optInSchema),
    defaultValues: { 
      phone: "", 
      officeId: "",
      consent: false 
    },
  });

  const optInMutation = useMutation({
    mutationFn: async (data: Omit<OptInFormData, 'consent'>) => {
      const res = await apiRequest("POST", "/api/sms/opt-in", {
        phone: data.phone.replace(/\D/g, ''), // Remove formatting
        officeId: data.officeId,
      });
      return res.json();
    },
    onSuccess: () => {
      setIsSuccess(true);
      toast({
        title: "Success!",
        description: "You've successfully opted in to SMS notifications.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: OptInFormData) => {
    optInMutation.mutate({
      phone: data.phone,
      officeId: data.officeId,
    });
  };

  const formatPhoneNumber = (value: string) => {
    const phoneNumber = value.replace(/[^\d]/g, '');
    const phoneNumberLength = phoneNumber.length;
    
    if (phoneNumberLength < 4) return phoneNumber;
    if (phoneNumberLength < 7) {
      return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`;
    }
    return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/10 to-accent">
      <div className="w-full max-w-md">
        {!isSuccess ? (
          <Card data-testid="card-opt-in-form">
            <CardHeader className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4 mx-auto">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">SMS Notifications</CardTitle>
              <p className="text-muted-foreground">
                Stay updated on your order status via text message
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="(555) 123-4567"
                    {...form.register("phone")}
                    onChange={(e) => {
                      const formatted = formatPhoneNumber(e.target.value);
                      form.setValue("phone", formatted);
                    }}
                    className="text-lg"
                    data-testid="input-phone"
                  />
                  {form.formState.errors.phone && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.phone.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="officeId">Office/Practice Code</Label>
                  <Input
                    id="officeId"
                    placeholder="Enter the code provided by your practice"
                    {...form.register("officeId")}
                    data-testid="input-office-id"
                  />
                  {form.formState.errors.officeId && (
                    <p className="text-sm text-destructive">
                      {form.formState.errors.officeId.message}
                    </p>
                  )}
                </div>

                <div className="p-4 bg-muted rounded-lg text-sm space-y-2">
                  <p className="font-medium">By opting in, you agree to receive:</p>
                  <ul className="list-disc list-inside text-muted-foreground space-y-1">
                    <li>Order status updates</li>
                    <li>Pickup notifications</li>
                    <li>Important reminders</li>
                  </ul>
                  <p className="text-xs text-muted-foreground mt-3">
                    Message and data rates may apply. Reply STOP to unsubscribe at any time.
                  </p>
                </div>

                <div className="flex items-start space-x-2">
                  <Checkbox
                    id="consent"
                    checked={form.watch("consent")}
                    onCheckedChange={(checked) => form.setValue("consent", !!checked)}
                    data-testid="checkbox-consent"
                  />
                  <Label htmlFor="consent" className="text-sm leading-relaxed">
                    I consent to receive SMS notifications about my orders
                  </Label>
                </div>
                {form.formState.errors.consent && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.consent.message}
                  </p>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={optInMutation.isPending}
                  data-testid="button-opt-in"
                >
                  {optInMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Opt In to SMS
                </Button>
              </form>

              <p className="text-xs text-center text-muted-foreground mt-6">
                Your privacy is important to us. We will never share your phone number.
              </p>
            </CardContent>
          </Card>
        ) : (
          /* Success State */
          <Card data-testid="card-opt-in-success">
            <CardContent className="p-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-success/10 rounded-full mb-4 mx-auto">
                <CheckCircle className="h-8 w-8 text-success" />
              </div>
              <h2 className="text-2xl font-bold mb-2">You're All Set!</h2>
              <p className="text-muted-foreground mb-6">
                You'll now receive SMS updates about your orders.
              </p>
              <div className="p-4 bg-muted rounded-lg text-sm text-left">
                <p className="font-medium mb-2">To unsubscribe:</p>
                <p className="text-muted-foreground">
                  Reply <span className="font-mono font-semibold">STOP</span> to any message
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
