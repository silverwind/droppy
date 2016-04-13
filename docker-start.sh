#!/bin/sh

[ -z "$UID" ] && UID=0
[ -z "$GID" ] && GID=0

# echo >> /etc/xxx and not adduser/addgroup because adduser/addgroup won't work if uid/gid already exists
echo -e "xuser:x:${UID}:${GID}:xuser:/app:/bin/false\n" >> /etc/passwd
echo -e "xgroup:x:${GID}:xuser\n" >> /etc/group

# it's better to do that (mkdir and chown) here than in the Dockerfile because it will be executed even on volumes if mounted
mkdir -p /config
mkdir -p /files

chown -R xuser:xgroup /config
chown xuser:xgroup /files

exec /bin/su -m -s "/bin/sh" -c 'exec node droppy.js start --filesdir /files --configdir /config --color' xuser
