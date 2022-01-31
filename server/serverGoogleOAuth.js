const {google} = require('googleapis');
const DF = require('../clientsrc/DFCommon');
const { UserDBRecordToPersistentInfo } = require('../clientsrc/DFUser');

class ServerGoogleOAuthSupport {
   constructor(gConfig, app, gDB) {
      this.gConfig = gConfig;
      this.gDB = gDB;

      if (!this.HasGoogleAPI()) {
         console.log(`DF_GOOGLE_CLIENT_ID or DF_GOOGLE_CLIENT_SECRET are not set; google login will not be available.`);
      } else {
         console.log(`Google auth enabled with client ID ${gConfig.google_client_id}`);
      }

      // here's an endpoint you can call to get a URL for logging in with google.
      app.get('/google_auth_url', async (req, res) => {
         try {
            res.setHeader('Content-Type', 'application/json');
            if (!this.HasGoogleAPI()) {
               res.send(JSON.stringify({url : null}));
               return;
            }

            if (req.query.google_refresh_token) {
               const token = await this.UseRefreshToken(req.query.google_refresh_token);
               if (token) {
                  res.send(JSON.stringify({google_access_token : token}));
                  return;
               }
            }

            const oauth2Client = new google.auth.OAuth2(
               this.gConfig.google_client_id,
               this.gConfig.google_client_secret,
               this.gConfig.google_redirect_url);

            const scopes = [
               'https://www.googleapis.com/auth/userinfo.email',
            ];

            const url = oauth2Client.generateAuthUrl({
               access_type : 'offline',
               prompt : 'consent',
               scope : scopes,
            });

            res.send(JSON.stringify({url}));
         } catch (e) {
            console.log(`Exception in /google_auth_url`);
            console.log(e);
         }
      });

      app.get('/google_complete_authentication', (req, res) => {
         try {
            res.setHeader('Content-Type', 'application/json');
            //console.log(`/google_complete_authentication invoked with code ${req.query.code}`);
            const code = req.query.code;
            const oauth2Client = new google.auth.OAuth2(
                gConfig.google_client_id,
                gConfig.google_client_secret,
                gConfig.google_redirect_url);

            oauth2Client.getToken(code).then(
                (tokens) => {
                   //console.log(`  => tokens retrieved: ${JSON.stringify(tokens)}`);
                   //console.log(`  => access token: ${tokens.tokens.access_token}`);
                   res.send(JSON.stringify({
                      google_access_token : tokens.tokens.access_token,
                      google_refresh_token : tokens.tokens.refresh_token,
                   }));
                },
                (rejection) => {
                   // {
                   // message, // 'invalid_grant'
                   // code, // 400,
                   // name // 'error'
                   // }
                   console.log(`Auth rejected: ${rejection.code} ${rejection.message}`);
                   res.send(JSON.stringify({
                      errorMessage: rejection.message,
                      code: rejection.code,
                  }));
               });
         } catch (e) {
            console.log(`Exception in /google_complete_authentication`);
            console.log(e);
         }
      });
   }

   HasGoogleAPI() {
      return this.gConfig.google_client_id && this.gConfig.google_client_secret;
   }

   async UseRefreshToken(google_refresh_token) {
      const oauth2Client = new google.auth.OAuth2(
         this.gConfig.google_client_id,
         this.gConfig.google_client_secret,
         this.gConfig.google_redirect_url);

      oauth2Client.setCredentials({
         refresh_token : google_refresh_token,
      });

      try {
         const resp = await oauth2Client.getAccessToken();
         return resp.token;
      } catch (e) {
      }
      return null;
   }

   // completeUserEntry is (hasPersistentIdentity, persistentInfo, persistentID)
   // rejectUserEntry is ()
   DoGoogleSignIn(ws, /*google_access_*/token, user, completeUserEntry, rejectUserEntry) {
      // use google auth token to get a google user id.
      ws.DFGoogleAccessToken = token;
      var oaclient = new google.auth.OAuth2();
      oaclient.setCredentials({access_token : token});
      var googleUser = google.oauth2({
         auth : oaclient,
         version : 'v2'
      });

      googleUser.userinfo.get(
          (err, res) => {
             if (err) {
                console.log(`google_access_token validation failed for token ${token}`);
                console.log(JSON.stringify(err.errors));
                rejectUserEntry();
             } else {
                // <email scope>
                //     "id": "1234567789345783495",
                //     "email": "email@something.com",
                //     "verified_email": true,
                const userDoc = this.gDB.GetOrCreateGoogleUser(res.data.id);//.then(userDoc => {
                completeUserEntry(true, UserDBRecordToPersistentInfo(userDoc), userDoc._id);
             }
          });
   }

   // checks if the websocket has a google access token.
   // if so, returns true and asynchronously completes login, eventually calling either completeUserEntry or rejectUserEntry
   // if not, returns false immediately.
   async TryProcessHandshake(user, clientSocket, completeUserEntry, rejectUserEntry, google_refresh_token) {
      let token = null;
      if (google_refresh_token) {
         token = await this.UseRefreshToken(google_refresh_token);
         clientSocket.DFGoogleAccessToken = token;
      }
      token = clientSocket.handshake.query.google_access_token ?? clientSocket.DFGoogleAccessToken;
      if (token) {
         this.DoGoogleSignIn(clientSocket, token, user, completeUserEntry, rejectUserEntry, google_refresh_token);
         return true;
      }
      return false;
   }
};

module.exports = {
    ServerGoogleOAuthSupport};
