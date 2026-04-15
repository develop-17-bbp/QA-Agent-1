import ReactMarkdown from "react-markdown";

/** Renders Markdown for run summaries and short LLM replies (trusted server content). */
export default function MarkdownBody({ markdown }: { markdown: string }) {
  return (
    <div className="run-markdown">
      <ReactMarkdown>{markdown}</ReactMarkdown>
    </div>
  );
}
