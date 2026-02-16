import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import { common, createLowlight } from "lowlight";
import { useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Code2,
  Quote,
  Minus,
  Link as LinkIcon,
} from "lucide-react";

const lowlight = createLowlight(common);

interface TipTapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function TipTapEditor({ content, onChange, placeholder }: TipTapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        horizontalRule: false,
      }),
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({
        placeholder: placeholder || "Start writing...",
      }),
      Underline,
      CodeBlockLowlight.configure({ lowlight }),
      HorizontalRule,
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  const toggleLink = useCallback(() => {
    if (!editor) return;
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("Enter URL:");
    if (url) {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  const toolbarItems = [
    { icon: Bold, action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive("bold"), testId: "toolbar-bold" },
    { icon: Italic, action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive("italic"), testId: "toolbar-italic" },
    { icon: UnderlineIcon, action: () => editor.chain().focus().toggleUnderline().run(), active: editor.isActive("underline"), testId: "toolbar-underline" },
    { icon: Heading2, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive("heading", { level: 2 }), testId: "toolbar-h2" },
    { icon: Heading3, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: editor.isActive("heading", { level: 3 }), testId: "toolbar-h3" },
    { icon: List, action: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive("bulletList"), testId: "toolbar-bullet-list" },
    { icon: ListOrdered, action: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive("orderedList"), testId: "toolbar-ordered-list" },
    { icon: Code2, action: () => editor.chain().focus().toggleCodeBlock().run(), active: editor.isActive("codeBlock"), testId: "toolbar-code-block" },
    { icon: Quote, action: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive("blockquote"), testId: "toolbar-blockquote" },
    { icon: Minus, action: () => editor.chain().focus().setHorizontalRule().run(), active: false, testId: "toolbar-horizontal-rule" },
    { icon: LinkIcon, action: toggleLink, active: editor.isActive("link"), testId: "toolbar-link" },
  ];

  return (
    <div data-testid="editor-article-content" className="border rounded-md">
      <div className="flex items-center gap-1 p-2 border-b flex-wrap">
        {toolbarItems.map((item) => (
          <Button
            key={item.testId}
            type="button"
            variant="ghost"
            size="icon"
            className={`toggle-elevate ${item.active ? "toggle-elevated" : ""}`}
            onClick={item.action}
            data-testid={item.testId}
          >
            <item.icon className="h-4 w-4" />
          </Button>
        ))}
      </div>
      <EditorContent
        editor={editor}
        className="prose dark:prose-invert max-w-none min-h-[400px] p-4 text-sm leading-relaxed [&_.tiptap]:outline-none [&_.tiptap]:min-h-[400px] [&_.tiptap_p.is-editor-empty:first-child::before]:text-muted-foreground [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:h-0 [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none"
      />
    </div>
  );
}
