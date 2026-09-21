import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            The page you're looking for doesn't exist or has moved.
          </p>
          <Button asChild data-testid="button-back-to-today">
            <Link href="/today">Back to Today</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
