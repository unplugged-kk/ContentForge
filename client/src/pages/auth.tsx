import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2, Mail, Lock, User, ArrowRight, ShieldCheck, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth0Session } from "@/lib/auth0";
import { invalidateCsrfToken } from "@/lib/csrf";
import { SiGoogle } from "react-icons/si";

export default function AuthPage() {
  const { toast } = useToast();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");

  const auth0 = useAuth0Session();
  const [auth0Starting, setAuth0Starting] = useState(false);
  const { data: authConfig } = useQuery<{ googleEnabled: boolean }>({
    queryKey: ["/api/auth/config"],
    retry: false,
  });

  const googleEnabled = authConfig?.googleEnabled ?? false;

  const loginMutation = useMutation({
    mutationFn: async ({ email, password }: { email: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", { email, password });
      return res.json();
    },
    onSuccess: (data) => {
      invalidateCsrfToken();
      queryClient.setQueryData(["/api/auth/me"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (err: any) => {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async ({ email, password, name }: { email: string; password: string; name: string }) => {
      const res = await apiRequest("POST", "/api/auth/register", { email, password, name });
      return res.json();
    },
    onSuccess: (data) => {
      invalidateCsrfToken();
      queryClient.setQueryData(["/api/auth/me"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Account created", description: `Welcome to ContentForge, ${data.name}` });
    },
    onError: (err: any) => {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    },
  });

  const handleGoogleSignIn = () => {
    window.location.href = "/api/auth/google";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-14 w-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
              <Sparkles className="h-7 w-7 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-auth-title">ContentForge</h1>
          <p className="text-sm text-muted-foreground">Your AI-powered content creation workspace</p>
        </div>

        <Card className="p-6 shadow-lg border-border/50">
          {auth0?.failure && (
            <Alert variant="destructive" className="mb-5" data-testid="alert-auth0-failure">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="space-y-2">
                <p>{auth0.failure}</p>
                <button
                  type="button"
                  className="font-medium underline underline-offset-4"
                  onClick={() => auth0.logout()}
                  data-testid="button-auth0-switch-account"
                >
                  Use a different account
                </button>
              </AlertDescription>
            </Alert>
          )}

          {auth0 && (
            <div className="mb-5">
              <Button
                className="w-full gap-2 font-medium"
                disabled={auth0Starting}
                onClick={() => {
                  setAuth0Starting(true);
                  auth0.login().catch(() => setAuth0Starting(false));
                }}
                data-testid="button-auth0-signin"
              >
                {auth0Starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Sign in or create an account
              </Button>
              <div className="flex items-center gap-3 mt-4">
                <div className="flex-1 border-t border-border" />
                <span className="text-xs text-muted-foreground">or use your existing login</span>
                <div className="flex-1 border-t border-border" />
              </div>
            </div>
          )}

          {googleEnabled && (
            <div className="mb-5">
              <Button
                variant="outline"
                className="w-full gap-2 font-medium"
                onClick={handleGoogleSignIn}
                data-testid="button-google-signin"
              >
                <SiGoogle className="h-4 w-4 text-[#4285F4]" />
                Continue with Google
              </Button>
              <div className="flex items-center gap-3 mt-4">
                <div className="flex-1 border-t border-border" />
                <span className="text-xs text-muted-foreground">or continue with email</span>
                <div className="flex-1 border-t border-border" />
              </div>
            </div>
          )}

          <Tabs defaultValue="login">
            <TabsList className="w-full">
              <TabsTrigger value="login" className="flex-1" data-testid="tab-login">Sign In</TabsTrigger>
              <TabsTrigger value="register" className="flex-1" data-testid="tab-register">Create Account</TabsTrigger>
            </TabsList>

            <TabsContent value="login" className="mt-5 space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    className="pl-9"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate({ email: loginEmail, password: loginPassword })}
                    data-testid="input-login-email"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="••••••••"
                    className="pl-9"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate({ email: loginEmail, password: loginPassword })}
                    data-testid="input-login-password"
                  />
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() => loginMutation.mutate({ email: loginEmail, password: loginPassword })}
                disabled={!loginEmail || !loginPassword || loginMutation.isPending}
                data-testid="button-login-submit"
              >
                {loginMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                Sign In with Email
              </Button>
            </TabsContent>

            <TabsContent value="register" className="mt-5 space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Kishore Kumar"
                    className="pl-9"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    data-testid="input-register-name"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    className="pl-9"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    data-testid="input-register-email"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="password"
                    placeholder="Min 6 characters"
                    className="pl-9"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    data-testid="input-register-password"
                  />
                </div>
              </div>
              <Button
                className="w-full"
                onClick={() => registerMutation.mutate({ email: regEmail, password: regPassword, name: regName })}
                disabled={!regName || !regEmail || !regPassword || registerMutation.isPending}
                data-testid="button-register-submit"
              >
                {registerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Create Account
              </Button>
            </TabsContent>
          </Tabs>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Your personal content creation workspace for Data & AI thought leadership.
        </p>
      </div>
    </div>
  );
}
