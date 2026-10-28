import os
import re
import json
import smtplib
from email.message import EmailMessage
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email import encoders
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models import Email, Attachment, DeletedEmail, Setting

from app.models.attachment import ATTACHMENT_STORAGE

class EmailService:
    @staticmethod
    def list_emails(session: Session, q: Optional[str] = None, folder: Optional[str] = None, 
                    account_id: Optional[int] = None, page: int = 1, per_page: int = 50,
                    sort_by: str = "date", sort_order: str = "desc"):
        # La lógica de filtrado de list_emails se moverá aquí
        pass

    @staticmethod
    def get_email_detail(email_id: int, session: Session):
        # La lógica de get_email se moverá aquí
        pass

    @staticmethod
    def delete_email(email_id: int, session: Session) -> bool:
        email = session.query(Email).filter(Email.id == email_id).first()
        if not email:
            return False
        
        existing = session.query(DeletedEmail).filter(
            DeletedEmail.account_id == email.account_id,
            DeletedEmail.message_id == email.message_id,
            DeletedEmail.folder == email.folder,
        ).first()
        
        if not existing and email.message_id:
            session.add(DeletedEmail(
                account_id=email.account_id,
                message_id=email.message_id,
                folder=email.folder,
            ))
        
        session.query(Attachment).filter(Attachment.email_id == email_id).delete()
        session.delete(email)
        
        try:
            import shutil
            shutil.rmtree(os.path.join(ATTACHMENT_STORAGE, str(email_id)))
        except FileNotFoundError:
            pass
        return True

    @staticmethod
    def build_eml(email: Email) -> bytes:
        msg = EmailMessage()
        msg["Subject"] = email.subject
        msg["From"] = f"{email.sender_name} <{email.sender_email}>" if email.sender_name else email.sender_email
        msg["To"] = email.recipients_to
        msg["Cc"] = email.recipients_cc
        msg["Date"] = email.date.isoformat() if email.date else ""
        msg["Message-ID"] = email.message_id
        if email.body_text:
            msg.set_content(email.body_text)
        if email.body_html:
            msg.add_alternative(email.body_html, subtype="html")
        return bytes(msg)

    @staticmethod
    def get_export_query(q: Optional[str], folder: Optional[str], account_id: Optional[int], session: Session):
        query = session.query(Email)
        if q:
            like = f"%{q}%"
            query = query.filter(
                or_(
                    Email.subject.ilike(like),
                    Email.sender_name.ilike(like),
                    Email.sender_email.ilike(like),
                    Email.body_text.ilike(like),
                )
            )
        if folder:
            query = query.filter(Email.folder == folder)
        if account_id:
            query = query.filter(Email.account_id == account_id)
        query = query.order_by(Email.date.asc().nullslast())
        return query

    @staticmethod
    def get_by_ids(ids: list[int], session: Session):
        return session.query(Email).filter(Email.id.in_(ids)).order_by(Email.date.asc().nullslast())

    @staticmethod
    def generate_mbox_from_emails(emails):
        for email in emails:
            raw = email.raw or EmailService.build_eml(email)
            raw_str = raw.decode("utf-8", errors="replace")
            from_hdr = f"From - {email.date.strftime('%a %b %d %H:%M:%S %Y') if email.date else 'Unknown'}"
            content = raw_str.replace("\nFrom ", "\n>From ")
            yield f"{from_hdr}\n".encode()
            yield content.encode("utf-8", errors="replace")
            if not content.endswith("\n"):
                yield b"\n"
            yield b"\n"

    @staticmethod
    def generate_mbox_export(q: Optional[str], folder: Optional[str], account_id: Optional[int], session: Session):
        query = EmailService.get_export_query(q, folder, account_id, session)
        yield from EmailService.generate_mbox_from_emails(query.yield_per(200))

    @staticmethod
    def generate_mbox_export_by_ids(ids: list[int], session: Session):
        emails = EmailService.get_by_ids(ids, session)
        yield from EmailService.generate_mbox_from_emails(emails)

    @staticmethod
    def forward_email(email_id: int, to_address: str, session: Session):
        email_obj = session.query(Email).filter(Email.id == email_id).first()
        if not email_obj:
            raise ValueError("Email no encontrado")

        smtp_row = session.query(Setting).filter(Setting.key == "smtp").first()
        if not smtp_row or not smtp_row.value:
            raise ValueError("No hay servidor SMTP configurado. Ve a Configuración → Reenvío de correos (SMTP) para configurarlo.")

        smtp_cfg = json.loads(smtp_row.value)
        if not smtp_cfg.get("server"):
            raise ValueError("Servidor SMTP no configurado. Ve a Configuración → Reenvío de correos (SMTP).")

        from_email = smtp_cfg.get("username", "") or "noreply@mailsilo.local"
        subject = email_obj.subject or "(sin asunto)"

        msg = MIMEMultipart("mixed")
        msg["From"] = from_email
        msg["To"] = to_address
        msg["Subject"] = f"Reenviado desde MailSilo: {subject}"

        body = EmailMessage()
        body.set_content(
            f"Correo reenviado desde MailSilo\n\n"
            f"Asunto original: {subject}\n"
            f"De: {email_obj.sender_name or email_obj.sender_email}\n"
            f"Fecha: {email_obj.date.isoformat() if email_obj.date else ''}\n\n"
            f"---\n{email_obj.body_text or '(sin contenido)'}"
        )
        if email_obj.body_html:
            body.add_alternative(
                f"<p>Correo reenviado desde <strong>MailSilo</strong></p>"
                f"<table><tr><td>Asunto:</td><td>{subject}</td></tr>"
                f"<tr><td>De:</td><td>{email_obj.sender_name or email_obj.sender_email}</td></tr>"
                f"<tr><td>Fecha:</td><td>{email_obj.date.isoformat() if email_obj.date else ''}</td></tr></table>"
                f"<hr>{email_obj.body_html or ''}",
                subtype="html",
            )

        msg.attach(body)

        eml_bytes = EmailService.build_eml(email_obj)
        part = MIMEBase("message", "rfc822")
        part.set_payload(eml_bytes)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", "attachment", filename=f"{subject}.eml")
        msg.attach(part)

        smtp_username = smtp_cfg.get("username", "") or from_email
        smtp_password = smtp_cfg.get("password", "")
        from app.crypto import decrypt
        smtp_password = decrypt(smtp_password)

        try:
            server = smtplib.SMTP(smtp_cfg["server"], smtp_cfg.get("port", 587), timeout=30)
            if smtp_cfg.get("use_ssl", True):
                server.starttls()
            if smtp_username and smtp_password:
                server.login(smtp_username, smtp_password)
            server.send_message(msg)
            server.quit()
        except smtplib.SMTPAuthenticationError:
            raise ValueError("Error de autenticación SMTP. Verifica usuario y contraseña en Configuración.")
        except smtplib.SMTPException as e:
            raise ValueError(f"Error SMTP: {e}")

email_service = EmailService()
