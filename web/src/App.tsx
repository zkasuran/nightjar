// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { MotionConfig } from "motion/react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Footer, Header } from "./components/Nav";
import { useRoute, useSectionScroll } from "./lib/router";
import { DemoProvider } from "./lib/useDemo";
import { Ask } from "./pages/Ask";
import { Book } from "./pages/Book";
import { Guard } from "./pages/Guard";
import { Home } from "./pages/Home";
import { Developers, How, Privacy, Reports } from "./pages/Info";
import { Lab } from "./pages/Lab";
import { Story } from "./pages/Story";
import { Tuner } from "./pages/Tuner";

const TITLES: Record<string, string> = {
  "": "Bedtime stories that learn what gets them to sleep",
  ask: "Ask for a story",
  story: "Tonight's chapter",
  tuner: "The tuner",
  guard: "Break the guardrail",
  lab: "Gemma in your browser",
  book: "The printed book",
  how: "How it works",
  privacy: "Privacy",
  reports: "Reports",
  developers: "Developers",
};

function view(page: string) {
  switch (page) {
    case "": return <Home />;
    case "ask": return <Ask />;
    case "story": return <Story />;
    case "tuner": return <Tuner />;
    case "guard": return <Guard />;
    case "lab": return <Lab />;
    case "book": return <Book />;
    case "how": return <How />;
    case "privacy": return <Privacy />;
    case "reports": return <Reports />;
    case "developers": return <Developers />;
    default:
      return (
        <div className="wrap sec">
          <div className="empty"><h2 className="h-m">That page does not exist</h2><p className="t-s">It may have been a typo in the link.</p><a className="btn primary" href="#/">Go home</a></div>
        </div>
      );
  }
}

function Page() {
  const r = useRoute();
  useSectionScroll(r);
  document.title = `Nightjar · ${TITLES[r.page] ?? "Not found"}`;
  return <ErrorBoundary resetKey={`${r.page}/${r.arg}`}>{view(r.page)}</ErrorBoundary>;
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <DemoProvider>
        <a className="sr-only" href="#main">Skip to content</a>
        <Header />
        <main id="main"><Page /></main>
        <Footer />
      </DemoProvider>
    </MotionConfig>
  );
}
