// Maestro runScript helper: asks the local push helper (tutorial recordings) to show a demo push. env: KIND booking|order|payment
http.get('http://127.0.0.1:8799/push/' + KIND);
