import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Component, Suspense, lazy, useEffect, useRef } from "react";
import { Toaster } from "./components/ui/sonner";
import { AppProvider, useApp } from "./context/AppContext";
import { api } from "./lib/api";
import Shell from "./components/Shell";
import { Spinner } from "./components/common";
import { NotificationList } from "./components/NotificationPanel";
import { routeLoaders } from "./lib/routePreload";

const Login = lazy(routeLoaders["/login"]);
const Dashboard = lazy(routeLoaders["/"]);
const Messages = lazy(routeLoaders["/messages"]);
const Groups = lazy(routeLoaders["/groups"]);
const Directory = lazy(routeLoaders["/directory"]);
const Employees = lazy(routeLoaders["/employee"]);
const Profile = lazy(routeLoaders["/people"]);
const Org = lazy(routeLoaders["/org"]);
const Tasks = lazy(routeLoaders["/tasks"]);
const Projects = lazy(routeLoaders["/projects"]);
const Settings = lazy(routeLoaders["/settings"]);
const Onboarding = lazy(routeLoaders["/onboarding"]);
const Beranda = lazy(routeLoaders["/beranda"]);
const Schedule = lazy(routeLoaders["/schedule"]);
const Marketplace = lazy(routeLoaders["/marketplace"]);

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center text-ink">
          <p className="text-base font-bold">Terjadi kendala saat memuat halaman.</p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false });
              window.location.reload();
            }}
            className="btn-accent h-10 px-5 text-xs font-bold"
          >
            Muat Ulang Halaman
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthCallback() {
  const done = useRef(false);
  const navigate = useNavigate();
  const { setSession } = useApp();
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const sid = new URLSearchParams(window.location.hash.slice(1)).get("session_id");
    window.history.replaceState(null, "", window.location.pathname);
    api.post("/auth/session", { session_id: sid })
      .then(({ data }) => { setSession(data); navigate("/", { replace: true }); })
      .catch((e) => { setSession(null); navigate(`/login?status=${e?.response?.data?.detail || "error"}`, { replace: true }); });
  }, [navigate, setSession]);
  return <Spinner label="Signing you in" />;
}

function Protected({ children }) {
  const { session } = useApp();
  if (session === undefined) return <Spinner label="Loading CIRCLE" />;
  if (!session?.user?.user_id) return <Navigate to="/login" replace />;
  if (session.user?.needs_onboarding) return <Onboarding />;
  return children;
}

function Router() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) return <AuthCallback />;
  return (
    <Suspense fallback={<Spinner label="Memuat halaman" />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Protected><Shell /></Protected>}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/beranda" element={<Beranda />} />
          <Route path="/beranda/:pid" element={<Beranda />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/messages/:cid" element={<Messages />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/directory" element={<Directory />} />
          <Route path="/employee" element={<Employees />} />
          <Route path="/people" element={<Employees />} />
          <Route path="/people/:uid" element={<Profile />} />
          <Route path="/org" element={<Org />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:pid" element={<Projects />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/marketplace/:itemId" element={<Marketplace />} />
          <Route path="/notifications" element={<div className="h-[calc(100dvh-7.5rem)] bg-surface md:h-screen"><NotificationList /></div>} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function PWANavigationBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const onNav = (e) => {
      const url = e?.detail?.url;
      if (url && typeof url === "string") {
        navigate(url);
      }
    };
    window.addEventListener("circle:navigate", onNav);
    return () => window.removeEventListener("circle:navigate", onNav);
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <AppProvider>
      <AppErrorBoundary>
        <BrowserRouter>
          <PWANavigationBridge />
          <Router />
        </BrowserRouter>
      </AppErrorBoundary>
      <Toaster position="top-center" richColors closeButton />
    </AppProvider>
  );
}
