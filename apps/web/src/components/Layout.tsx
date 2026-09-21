import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Task Board
        </Link>
        {user && (
          <div className="topbar-user">
            <span className="topbar-name">{user.name}</span>
            <button type="button" className="btn btn-quiet" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        )}
      </header>
      <main id="main" className="page">
        <Outlet />
      </main>
    </>
  );
}
