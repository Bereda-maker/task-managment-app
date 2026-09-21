import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import BoardPage from "./pages/Board";
import BoardsPage from "./pages/Boards";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<BoardsPage />} />
          <Route path="/boards/:boardId" element={<BoardPage />} />
        </Route>
        <Route
          path="*"
          element={
            <div className="empty">
              <h1>Page not found</h1>
              <p>
                <a href="/">Go to your boards</a>
              </p>
            </div>
          }
        />
      </Route>
    </Routes>
  );
}
