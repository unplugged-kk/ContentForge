"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 overlay-motion data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/**
 * Restores focus to the control that opened the dialog.
 *
 * Radix restores focus on close only when the dialog is opened through its own
 * `<Dialog.Trigger>`: the modal content calls `event.preventDefault()` and then
 * focuses `triggerRef`, which is `null` for a controlled dialog opened from a
 * plain button. Because the default is prevented anyway, Radix's own
 * `previouslyFocusedElement` fallback in `FocusScope` never runs either — so
 * every controlled dialog dropped focus to `<body>` on close.
 *
 * Capturing the previously focused element here — at the same moment Radix's
 * `FocusScope` captures it, before autofocus moves into the content — lets the
 * close handler put focus back on the opener, trigger or not. The trigger, when
 * present, still wins: Radix's own `onCloseAutoFocus` runs after this one and
 * focuses it.
 *
 * @internal Shared by `Dialog` and `AlertDialog`; not part of the primitive API.
 */
export function useRestoreFocusToOpener(
  onOpenAutoFocus: ((event: Event) => void) | undefined,
  onCloseAutoFocus: ((event: Event) => void) | undefined,
) {
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);

  return {
    onOpenAutoFocus: (event: Event) => {
      onOpenAutoFocus?.(event);
      // Runs before the content is autofocused, so `activeElement` is still the
      // control the user activated.
      const active = document.activeElement;
      previouslyFocusedRef.current = active instanceof HTMLElement ? active : null;
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event);
      if (event.defaultPrevented) return;
      const previous = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      // Nothing to return to (window-triggered open, or the opener unmounted);
      // leave the default behaviour alone rather than guessing a target.
      if (previous && previous !== document.body && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    },
  };
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  const focusHandlers = useRestoreFocusToOpener(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        {...focusHandlers}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto border bg-background p-6 shadow-lg overlay-motion data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
