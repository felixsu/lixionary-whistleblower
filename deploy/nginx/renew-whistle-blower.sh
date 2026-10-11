#!/bin/sh
set -eu
case " ${RENEWED_DOMAINS:-} " in
  *" whistle-blower.lixionary.com "*)
    /usr/sbin/nginx -t
    /bin/systemctl reload nginx
    ;;
esac
