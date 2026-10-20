#!/bin/sh
# Only the rating system and the admin workstation may open new connections to the Docker-published
# MongoDB port (27017). Docker publishes it through its own chains, so ufw rules never apply to it;
# DOCKER-USER is the chain Docker evaluates first and leaves alone. Safe to run again.
PORT=27017
ALLOWED="192.168.110.19 192.168.110.41"
CHAIN=ITRS-MONGO

iptables -N $CHAIN 2>/dev/null || iptables -F $CHAIN
for ip in $ALLOWED; do
  iptables -A $CHAIN -s $ip -j RETURN
done
# Client-to-server packets only (--ctdir ORIGINAL); replies from the container are untouched.
iptables -A $CHAIN -j DROP

while iptables -D DOCKER-USER -p tcp -m conntrack --ctorigdstport $PORT --ctdir ORIGINAL -j $CHAIN 2>/dev/null; do :; done
iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport $PORT --ctdir ORIGINAL -j $CHAIN
