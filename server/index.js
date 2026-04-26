import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from "passport-google-oauth2";
import session from "express-session";
import env from "dotenv";
import { google } from 'googleapis';
import cors from 'cors';
import userRoutes from './routes/userRoutes.js';
import { fileURLToPath } from 'url';
import path from 'path';
import connectPgSimple from 'connect-pg-simple';
const pgSession = connectPgSimple(session);
env.config();

const fetchImpl = globalThis.fetch;


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientBuildDir = path.join(__dirname, '../Client/build');
const clientIndexPath = path.join(clientBuildDir, 'index.html');




const app = express();
const port = process.env.PORT || 5000;
const saltRounds = 10;
app.use(express.json());

const isProduction = process.env.NODE_ENV === 'production';
const clientBaseUrl = process.env.APP_BASE_URL || (
  isProduction
    ? "https://yumu.onrender.com"
    : "http://localhost:3000"
);
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || (
  isProduction
    ? `${clientBaseUrl}/auth/google/secrets`
    : "http://localhost:5000/auth/google/secrets"
);
const allowedEmails = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

function createGoogleOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    googleCallbackUrl
  );
}

const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
    }
  : {
      user: process.env.PG_USER,
      host: process.env.PG_HOST,
      database: process.env.PG_DATABASE,
      password: process.env.PG_PASSWORD,
      port: process.env.PG_PORT,
      ssl: false,
    };

app.use(session({
  store: new pgSession({
    conObject: dbConfig,
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));


app.use(cors({
  origin: ['http://localhost:3000', clientBaseUrl],
  methods: 'GET,POST',
  allowedHeaders: ['Content-Type', 'Content-Disposition'],
  exposedHeaders: ['Content-Disposition'], // Expose the Content-Disposition header
  credentials: true,
}));

app.use(bodyParser.urlencoded({ extended: true }));
// app.use(express.static("public"));
if (isProduction) {
  app.use(express.static(clientBuildDir));
}

app.use(passport.initialize());
app.use(passport.session());


const db = new pg.Client({
  ...dbConfig,
});

async function initializeDatabase() {
  await db.connect();
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);
}


// for download routes
app.use('/api', userRoutes);


//  solely checks authentication
app.get('/api/authenticated', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ isAuthenticated: true });
  } else {
    res.json({ isAuthenticated: false });
  }
});


//  endpoint to fetch playlists
app.get('/api/playlists', async (req, res, next) => {
  if (req.isAuthenticated()) {
    try {
      if (!req.user?.accessToken && !req.user?.refreshToken) {
        return res.status(401).json({ error: 'Google login expired. Please sign in again.' });
      }

      // Use the stored OAuth2 client and tokens
      const oauth2Client = createGoogleOAuthClient();
      oauth2Client.setCredentials({
        access_token: req.user.accessToken,
        refresh_token: req.user.refreshToken,
      });

      // Automatically refresh the access token if it's expired
      await oauth2Client.getAccessToken();

      const youtube = google.youtube({
        version: 'v3',
        auth: oauth2Client,
      });

      const response = await youtube.playlists.list({
        part: 'id,snippet',
        mine: true,
        maxResults: 50,
      });

      const playlists = response.data.items.map((playlist) => ({
        id: playlist.id,
        title: playlist.snippet.title,
        thumbnails: playlist.snippet.thumbnails,
      }));

      res.json({ playlists });
    } catch (err) {
      console.error('Error fetching YouTube playlists:', err);
      if (err?.code === 401 || err?.response?.status === 401) {
        return res.status(401).json({ error: 'Google login expired. Please sign in again.' });
      }
      res.status(500).json({ error: 'Failed to fetch playlists' });
    }
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

app.get("/logout", (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});


app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email", "https://www.googleapis.com/auth/youtube.readonly"],
    accessType: "offline",
    prompt: "consent",
  })
);

app.get('/auth/google/secrets',
  passport.authenticate('google', { failureRedirect: '/login' }),
  function (req, res) {
    // After auth, send the user back to the frontend app.
    res.redirect(clientBaseUrl);
  });


app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: clientBaseUrl,
    failureRedirect: "/login",
  })
);

// just emails and passwords
app.post("/register", async (req, res, next) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      res.redirect("/login");
    } else {
      bcrypt.hash(password, saltRounds, async (err, hash) => {
        if (err) {
          console.error("Error hashing password:", err);
        } else {
          const result = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [email, hash]
          );
          const user = result.rows[0];
          req.login(user, (err) => {
            console.log("success");
            res.redirect(clientBaseUrl);
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

// Serve the built React app in production only.
if (isProduction) {
  app.get('*', (req, res) => {
    res.sendFile(clientIndexPath, (err) => {
      if (err) {
        console.error(`React build missing at ${clientIndexPath}. Check Render's build command.`);
        res.status(500).send("React build is missing. Check the Render build command.");
      }
    });
  });
}

passport.use(
  "local",
  new Strategy(async function verify(username, password, done) {
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1", [
        username,
      ]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            return done(err);
          }
          return valid ? done(null, user) : done(null, false);
        });
      } else {
        return done(null, false);
      }
    } catch (err) {
      return done(err);
    }
  })
);


passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: googleCallbackUrl,
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.email?.toLowerCase();
        if (allowedEmails.length > 0 && !allowedEmails.includes(email)) {
          return done(null, false, { message: "Email is not allowed for this app." });
        }

        const result = await db.query("SELECT * FROM users WHERE email = $1", [
          profile.email,
        ]);

        let user;
        if (result.rows.length === 0) {
          const newUser = await db.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING *",
            [profile.email, "google"]
          );
          user = newUser.rows[0];
        } else {
          user = result.rows[0];
        }

        // Attach tokens to the user object
        user.accessToken = accessToken;
        user.refreshToken = refreshToken;

        return done(null, user);
      } catch (err) {
        console.error("Error in Google Strategy:", err);
        return done(err);
      }
    }
  )
);


passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});




initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
