select public._create_user('Gabin', 'Muller', 'CHANGEZ-MOI-123', 'maire');

select prenom, nom, role, is_active, login_email from public.profiles where role = 'maire';
