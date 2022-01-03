const {google} = require('googleapis');
const DF = require('../clientsrc/DFCommon');

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
            const oauth2Client = new google.auth.OAuth2(
                this.gConfig.google_client_id,
                this.gConfig.google_client_secret,
                this.gConfig.google_redirect_url);

            if (req.query.google_refresh_token) {
               oauth2Client.setCredentials({
                  refresh_token : req.query.google_refresh_token
               });

               try {
                  const resp = await oauth2Client.getAccessToken();
                  res.send(JSON.stringify({google_access_token : resp.token}));
                  return;
               } catch (e) {
               }
            }

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

   // checks if the websocket has a google access token
   TryProcessHandshake(user, clientSocket, completeUserEntry, rejectUserEntry) {
      const token = clientSocket.handshake.query.google_access_token;
      if (!token) {
         return;
      }
      // use google auth token to get a google user id.
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
                this.gDB.GetOrCreateGoogleUser(user.name, user.color, res.data.id).then(userDoc => {
                  this.gDB.GetFollowerCount(userDoc._id).then(followersCount => {
                      //console.log(`OK i have this user doc: ${JSON.stringify(userDoc, null, 2)}`);
                      completeUserEntry(true, DF.DFUserToPersistentInfo(userDoc, followersCount), userDoc._id);
                   });
                });
             }
          });
      return true;
   }
};

module.exports = {
    ServerGoogleOAuthSupport};
