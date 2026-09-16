import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

export function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await signUp(email, password, fullName);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="max-w-sm mx-auto mt-16 text-center">
        <h1 className="text-xl font-bold mb-2">Check your email</h1>
        <p className="text-gray-600 text-sm">
          Confirm your email, then{" "}
          <button onClick={() => navigate("/login")} className="text-gray-900 font-medium underline">
            sign in
          </button>{" "}
          to submit your merchant application.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto mt-16">
      <h1 className="text-xl font-bold mb-4">Create your account</h1>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          placeholder="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gray-900 text-white py-2.5 rounded-md font-medium hover:bg-gray-800 disabled:opacity-60"
        >
          {loading ? "Creating account..." : "Continue"}
        </button>
      </form>
      <p className="text-sm text-gray-500 mt-4">
        Already have an account?{" "}
        <Link to="/login" className="text-gray-900 font-medium underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
