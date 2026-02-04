import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Building, UserPlus, ArrowLeft } from "lucide-react";

const createOfficeSchema = z.object({
  name: z.string().min(1, "Office name is required"),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Please enter a valid email").optional().or(z.literal("")),
});

const joinRequestSchema = z.object({
  ownerEmail: z.string().email("Please enter a valid email address"),
  message: z.string().optional(),
});

type CreateOfficeData = z.infer<typeof createOfficeSchema>;
type JoinRequestData = z.infer<typeof joinRequestSchema>;

export default function OfficeSetup() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [selectedOption, setSelectedOption] = useState<"create" | "join" | null>(null);

  const createOfficeForm = useForm<CreateOfficeData>({
    resolver: zodResolver(createOfficeSchema),
    defaultValues: { name: "", address: "", phone: "", email: "" },
  });

  const joinRequestForm = useForm<JoinRequestData>({
    resolver: zodResolver(joinRequestSchema),
    defaultValues: { ownerEmail: "", message: "" },
  });

  const createOfficeMutation = useMutation({
    mutationFn: async (data: CreateOfficeData) => {
      const res = await apiRequest("POST", "/api/offices", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Office Created",
        description: "Your office has been created successfully!",
      });
      navigate("/dashboard");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const joinRequestMutation = useMutation({
    mutationFn: async (data: JoinRequestData) => {
      const res = await apiRequest("POST", "/api/join-requests", data);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Request Sent",
        description: "Your join request has been sent to the office owner.",
      });
      // Stay on this page to show success state
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onCreateOffice = (data: CreateOfficeData) => {
    createOfficeMutation.mutate(data);
  };

  const onJoinRequest = (data: JoinRequestData) => {
    joinRequestMutation.mutate(data);
  };

  if (user?.officeId) {
    navigate("/");
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-primary/5 to-accent/5">
      <div className="w-full max-w-4xl space-y-8">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground mb-2">Set Up Your Practice</h1>
          <p className="text-muted-foreground">Create a new office or join an existing one</p>
        </div>

        {selectedOption === null ? (
          /* Option Selection */
          <div className="grid md:grid-cols-2 gap-6">
            <Card 
              className="hover:shadow-lg transition-all cursor-pointer border-2 hover:border-primary"
              onClick={() => setSelectedOption("create")}
              data-testid="card-create-office"
            >
              <CardHeader className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-primary/10 rounded-full mb-4 mx-auto">
                  <Building className="h-8 w-8 text-primary" />
                </div>
                <CardTitle>Create New Office</CardTitle>
                <p className="text-sm text-muted-foreground">Start fresh with your own practice</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    Full administrative control
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    Invite team members
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    Customize workflows
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card 
              className="hover:shadow-lg transition-all cursor-pointer border-2 hover:border-primary"
              onClick={() => setSelectedOption("join")}
              data-testid="card-join-office"
            >
              <CardHeader className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-accent rounded-full mb-4 mx-auto">
                  <UserPlus className="h-8 w-8 text-primary" />
                </div>
                <CardTitle>Join Existing Office</CardTitle>
                <p className="text-sm text-muted-foreground">Request to join your team</p>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    Connect with your practice
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    Instant team collaboration
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    No setup required
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          /* Selected Option Form */
          <div className="max-w-2xl mx-auto">
            <Button 
              variant="ghost" 
              onClick={() => setSelectedOption(null)}
              className="mb-4"
              data-testid="button-back"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to options
            </Button>

            {selectedOption === "create" ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building className="h-5 w-5 text-primary" />
                    Create New Office
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Enter your practice information to get started
                  </p>
                </CardHeader>
                <CardContent>
                  <form onSubmit={createOfficeForm.handleSubmit(onCreateOffice)} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Office Name *</Label>
                      <Input
                        id="name"
                        placeholder="Smith Eye Care"
                        {...createOfficeForm.register("name")}
                        data-testid="input-office-name"
                      />
                      {createOfficeForm.formState.errors.name && (
                        <p className="text-sm text-destructive">
                          {createOfficeForm.formState.errors.name.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="address">Address</Label>
                      <Input
                        id="address"
                        placeholder="123 Main St, City, ST 12345"
                        {...createOfficeForm.register("address")}
                        data-testid="input-office-address"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="(555) 123-4567"
                          {...createOfficeForm.register("phone")}
                          data-testid="input-office-phone"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="contact@practice.com"
                          {...createOfficeForm.register("email")}
                          data-testid="input-office-email"
                        />
                        {createOfficeForm.formState.errors.email && (
                          <p className="text-sm text-destructive">
                            {createOfficeForm.formState.errors.email.message}
                          </p>
                        )}
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full"
                      disabled={createOfficeMutation.isPending}
                      data-testid="button-create-office"
                    >
                      {createOfficeMutation.isPending && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      Create Office
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserPlus className="h-5 w-5 text-primary" />
                    Join Existing Office
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Request to join your practice team
                  </p>
                </CardHeader>
                <CardContent>
                  {joinRequestMutation.isSuccess ? (
                    <div className="text-center py-8 space-y-4">
                      <div className="inline-flex items-center justify-center w-16 h-16 bg-success/10 rounded-full mb-4">
                        <span className="text-2xl">✓</span>
                      </div>
                      <h3 className="text-lg font-semibold">Request Sent!</h3>
                      <p className="text-muted-foreground">
                        Your join request has been sent to the office owner. 
                        You'll be notified once they review your request.
                      </p>
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setSelectedOption(null);
                          joinRequestForm.reset();
                        }}
                        data-testid="button-send-another"
                      >
                        Send Another Request
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={joinRequestForm.handleSubmit(onJoinRequest)} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="ownerEmail">Owner's Email *</Label>
                        <Input
                          id="ownerEmail"
                          type="email"
                          placeholder="owner@practice.com"
                          {...joinRequestForm.register("ownerEmail")}
                          data-testid="input-owner-email"
                        />
                        {joinRequestForm.formState.errors.ownerEmail && (
                          <p className="text-sm text-destructive">
                            {joinRequestForm.formState.errors.ownerEmail.message}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="message">Message (Optional)</Label>
                        <Textarea
                          id="message"
                          rows={4}
                          placeholder="Hi, I'd like to join your practice..."
                          {...joinRequestForm.register("message")}
                          data-testid="input-join-message"
                        />
                      </div>

                      <Button
                        type="submit"
                        className="w-full"
                        disabled={joinRequestMutation.isPending}
                        data-testid="button-send-request"
                      >
                        {joinRequestMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Send Request
                      </Button>
                    </form>
                  )}

                  {!joinRequestMutation.isSuccess && (
                    <div className="mt-4 p-3 bg-muted rounded-md">
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <span className="w-4 h-4 rounded-full bg-info flex items-center justify-center text-white text-xs">i</span>
                        Your request will be sent to the office owner for approval
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
