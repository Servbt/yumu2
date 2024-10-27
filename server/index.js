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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);




const app = express();
const port = process.env.PORT || 5000;
const saltRounds = 10;
env.config();
app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://yumu-4843fa0b7770.herokuapp.com/auth/google/secrets"
);


app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
}));

app.use(cors({
  origin: ['http://localhost:3000', 'https://yumu-4843fa0b7770.herokuapp.com'], 
  methods: 'GET,POST',
  allowedHeaders: ['Content-Type', 'Content-Disposition'],
  exposedHeaders: ['Content-Disposition'], // Expose the Content-Disposition header
  credentials: true,
}));

app.use(bodyParser.urlencoded({ extended: true }));
// app.use(express.static("public"));
app.use(express.static(path.join(__dirname, '../Client/build')));

app.use(passport.initialize());
app.use(passport.session());

const isProduction = process.env.NODE_ENV === 'production';


const db = new pg.Client({
  connectionString: isProduction ? process.env.DATABASE_URL : undefined,
  user: isProduction ? undefined : process.env.PG_USER,
  host: isProduction ? undefined : process.env.PG_HOST,
  database: isProduction ? undefined : process.env.PG_DATABASE,
  password: isProduction ? undefined : process.env.PG_PASSWORD,
  port: isProduction ? undefined : process.env.PG_PORT,
  ssl: isProduction ? { rejectUnauthorized: false } : false, 
});

db.connect();


// for download routes
app.use('/api', userRoutes);

// Fallback route: for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../Client/build', 'index.html'));
});



//  solely checks authentication
app.get('/api/authenticated', (req, res) => {
  res.json({ isAuthenticated: req.isAuthenticated() });
});

//  endpoint to fetch playlists
app.get('/api/playlists', async (req, res, next) => {
  if (req.isAuthenticated()) {
    try {
      // Use the stored OAuth2 client and tokens
      oauth2Client.setCredentials({
        access_token: req.user.accessToken,
        refresh_token: req.user.refreshToken,
      });

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
  })
);

app.get('/auth/google/secrets', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  function(req, res) {
    // Successful authentication, redirect to secrets page or wherever.
    res.redirect('/secrets');
  });


app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/secrets",
    failureRedirect: "/login",
  })
);

app.post("/register", async (req, res , next) => {
  const email = req.body.username;
  const password = req.body.password;

  try {
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (checkResult.rows.length > 0) {
      res.redirect("/login");
    }  else {
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
            res.redirect("/secrets");
          });
        }
      });
    }
  } catch (err) {
    console.log(err);
  }
});

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
      callbackURL: isProduction
        ? "https://yumu-4843fa0b7770.herokuapp.com/auth/google/secrets"
        : "http://localhost:5000/auth/google/secrets",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, done) => {
      console.log('Access Token:', accessToken);
      console.log('Refresh Token:', refreshToken);
      console.log('Profile:', profile);
      try {
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});