"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";

export function AuthControls() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return null;
  }
  return <ClerkAuthControls />;
}

function ClerkAuthControls() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <div className="h-7 w-7" aria-hidden />;
  }

  return (
    <div className="inline-flex items-center">
      {isSignedIn ? (
        <UserButton />
      ) : (
        <SignInButton
          mode="redirect"
          oauthFlow="redirect"
          forceRedirectUrl="/auth/complete"
          fallbackRedirectUrl="/auth/complete"
          signUpForceRedirectUrl="/auth/complete"
          signUpFallbackRedirectUrl="/auth/complete"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="bg-card/70 backdrop-blur-sm"
            aria-label="Googleでログイン"
          >
            <LogIn className="w-3.5 h-3.5" />
            ログイン
          </Button>
        </SignInButton>
      )}
    </div>
  );
}
