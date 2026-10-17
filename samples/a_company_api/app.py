"""
A社 顧客データ提供API（デモ用サンプル）

A社が持つ顧客の購買データを、提携先のB社に毎日提供するためのAPI。
B社はこのデータを使って、自社サービスのおすすめ表示を行っている。

※ 学習用に、運用で問題になりやすい書き方をわざと含めています。実運用では使わないでください。
"""
import logging
import sqlite3

from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins="*")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("a-company-api")

# B社に渡しているAPIキー（全提携先で共通）
PARTNER_API_KEY = "a-company-partner-2024"
DB_PATH = "customers.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def check_key():
    return request.headers.get("X-API-Key") == PARTNER_API_KEY


@app.route("/api/purchases")
def purchases():
    """B社が毎朝呼ぶ、前日分の購買データ"""
    if not check_key():
        return jsonify({"error": "unauthorized"}), 401
    date = request.args.get("date")
    db = get_db()
    rows = db.execute(
        f"SELECT customer_id, item, price, purchased_at FROM purchases WHERE date(purchased_at) = '{date}'"
    ).fetchall()
    logger.info("purchases requested date=%s count=%d", date, len(rows))
    return jsonify([dict(r) for r in rows])


@app.route("/api/customers/search")
def search_customers():
    """B社のサポート窓口が、問い合わせ対応で顧客を探すときに使う"""
    if not check_key():
        return jsonify({"error": "unauthorized"}), 401
    name = request.args.get("name", "")
    db = get_db()
    rows = db.execute(
        "SELECT * FROM customers WHERE name LIKE '%" + name + "%'"
    ).fetchall()
    for r in rows:
        logger.info("customer hit: %s %s %s", r["name"], r["email"], r["phone"])
    return jsonify([dict(r) for r in rows])


@app.route("/api/export")
def export_all():
    """月末の突き合わせ用。社内から手動で呼ぶ想定"""
    db = get_db()
    rows = db.execute("SELECT * FROM customers").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/customers/<int:customer_id>", methods=["DELETE"])
def delete_customer(customer_id):
    """退会処理"""
    if not check_key():
        return jsonify({"error": "unauthorized"}), 401
    db = get_db()
    db.execute("DELETE FROM customers WHERE id = ?", (customer_id,))
    db.commit()
    return jsonify({"deleted": customer_id})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
